// DOM renderer compatibility surface for OpenSheetMusicDisplay.
import {DEFAULT_PPQ, secondsToTick, type Score} from '../../core';
import {scoreToNoteSequence} from '../core/note-sequence';
import type {RenderedScoreVisualizer, ScoreSequenceNote} from '../core/types';

/**
 * OpenSheetMusicDisplay-backed staff renderer.
 *
 * OSMD supplies responsive system breaks and page engraving as an optional
 * peer. The built-in VexFlow staff renderer owns continuous playback notation.
 *
 * View deliberately does not depend on `@webmusic/score/play`, so the caller
 * supplies the MusicXML — either pre-serialized (`musicXML`) or via a
 * converter (`toMusicXML`, e.g. `serializeMusicXML` from `@webmusic/score/io`).
 * The OSMD class itself may be injected (`OpenSheetMusicDisplay`/`osmd`) or
 * is dynamically imported from the `opensheetmusicdisplay` peer dependency.
 */
export interface OSMDStaffOptions {
  /** Pre-serialized MusicXML to render. Takes precedence over `toMusicXML`. */
  musicXML?: string;
  /** Convert the score to a MusicXML string (e.g. `serializeMusicXML` from `@webmusic/score/io`). */
  toMusicXML?: (score: Score) => string;
  /** OSMD constructor, injected to avoid a hard dependency. */
  OpenSheetMusicDisplay?: new (container: string | HTMLElement, options?: unknown) => OSMDLike;
  /**
   * An already-constructed OSMD instance to reuse. Calls sharing one instance
   * are serialized; a newer overlapping call supersedes the older one with an
   * `AbortError`, and stale visualizer handles become inert.
   */
  osmd?: OSMDLike;
  /** Extra options forwarded to the OSMD constructor. */
  osmdOptions?: Record<string, unknown>;
  /** Scroll the cursor into view on each redraw. Default: true. */
  followCursor?: boolean;
  /**
   * Cancel this render generation. OSMD's `load()` API is not itself
   * abortable, but an aborted request is prevented from rendering or clearing
   * a newer view once that load eventually settles. A later call reusing the
   * same injected instance remains serialized behind that underlying load;
   * switch instances when the host needs an independent cancellation domain.
   */
  signal?: AbortSignal;
}

/** Minimal structural type for the bits of OSMD we touch (duck-typed). */
interface OSMDLike {
  load(content: string): Promise<unknown>;
  render(): void;
  cursor?: OSMDCursor;
  /** Clears the rendered sheet (OSMD >= 0.7). */
  clear?(): void;
}

interface AdoptedOSMDState {
  /** Serialize load/render operations because one OSMD instance has one mutable score. */
  tail: Promise<void>;
  /** Latest render/dispose owner; older handles must not touch the shared instance. */
  generation: number;
}

const adoptedOSMDStates = new WeakMap<OSMDLike, AdoptedOSMDState>();

interface OSMDCursor {
  show?(): void;
  hide?(): void;
  reset?(): void;
  next?(): void;
  update?(): void;
  cursorElement?: {scrollIntoView?(options?: ScrollIntoViewOptions): void};
  iterator?: {
    EndReached?: boolean;
    currentTimeStamp?: {RealValue?: number};
  };
}

export async function renderOSMDStaffVisualizer(
  score: Score,
  container: HTMLElement,
  options: OSMDStaffOptions = {},
): Promise<RenderedScoreVisualizer<OSMDLike>> {
  assertOSMDRequestCurrent(options.signal);
  const musicXML = options.musicXML ?? options.toMusicXML?.(score);
  if (!musicXML) {
    throw new Error(
      'renderOSMDStaffVisualizer requires `musicXML` or `toMusicXML` ' +
        '(e.g. serializeMusicXML from @webmusic/score/io).',
    );
  }

  const Ctor = options.OpenSheetMusicDisplay ?? (options.osmd ? undefined : await loadOSMD());
  assertOSMDRequestCurrent(options.signal);
  const constructedHere = !options.osmd;
  // OSMD's own autoResize attaches a window `resize` listener it never removes
  // (a leak per construction). We construct with autoResize:false and manage a
  // removable container observer ourselves; dispose() detaches it.
  const osmdConstructorOptions = {
    autoResize: false,
    followCursor: options.followCursor ?? true,
    drawingParameters: 'default',
    ...options.osmdOptions,
  };
  const osmd =
    options.osmd ?? new (Ctor as NonNullable<typeof Ctor>)(container, osmdConstructorOptions);
  let adoptedState: AdoptedOSMDState | undefined;
  let adoptedGeneration: number | undefined;
  if (!constructedHere) {
    // An injected OSMD instance is mutable and can only hold one loaded score.
    // Serialize callers that reuse it and make the newest request the owner.
    // This prevents an older, slower load (or its later dispose/redraw) from
    // overwriting a newer React render that uses the same instance.
    adoptedState = adoptedOSMDStates.get(osmd);
    if (!adoptedState) {
      adoptedState = {tail: Promise.resolve(), generation: 0};
      adoptedOSMDStates.set(osmd, adoptedState);
    }
    adoptedGeneration = ++adoptedState.generation;
  }

  let aborted = false;
  let removeAbortListener: (() => void) | undefined;
  const onAbort = (): void => {
    aborted = true;
    if (adoptedState && adoptedState.generation === adoptedGeneration) {
      // Invalidate immediately, even though the third-party load cannot be
      // force-cancelled. A later request using another OSMD instance (or the
      // lightweight renderer) therefore does not need to touch this WeakMap.
      adoptedState.generation += 1;
    }
  };
  if (options.signal) {
    if (options.signal.aborted) onAbort();
    else {
      options.signal.addEventListener('abort', onAbort, {once: true});
      removeAbortListener = () => options.signal?.removeEventListener('abort', onAbort);
    }
  }

  try {
    if (constructedHere) {
      assertOSMDRequestCurrent(options.signal, undefined, undefined, aborted);
      await osmd.load(musicXML);
      assertOSMDRequestCurrent(options.signal, undefined, undefined, aborted);
      osmd.render();
      assertOSMDRequestCurrent(options.signal, undefined, undefined, aborted);
    } else {
      const state = adoptedState as AdoptedOSMDState;
      const generation = adoptedGeneration as number;
      const operation = state.tail
        .catch(() => undefined)
        .then(async () => {
          assertOSMDRequestCurrent(options.signal, state, generation, aborted);
          await osmd.load(musicXML);
          assertOSMDRequestCurrent(options.signal, state, generation, aborted);
          osmd.render();
          assertOSMDRequestCurrent(options.signal, state, generation, aborted);
        });
      // A rejected/superseded request must not poison the queue for its successor.
      state.tail = operation.then(() => undefined, () => undefined);
      await operation;
    }
  } catch (error) {
    removeAbortListener?.();
    if (constructedHere && aborted) {
      try {
        osmd.clear?.();
      } catch {
        // Cancellation remains authoritative over best-effort local cleanup.
      }
    }
    throw error;
  }

  let released = false;
  const ownsOSMD = (): boolean =>
    !released && !aborted &&
    (adoptedState === undefined || adoptedState.generation === adoptedGeneration);

  let removeResizeListener: (() => void) | undefined;
  if (
    constructedHere &&
    osmdConstructorOptions.autoResize === false &&
    typeof window !== 'undefined'
  ) {
    let pending: ReturnType<typeof setTimeout> | undefined;
    let width = container.getBoundingClientRect().width;
    let needsRender = false;
    const cancelPending = (): void => {
      if (pending !== undefined) clearTimeout(pending);
      pending = undefined;
    };
    const onResize = (): void => {
      if (!ownsOSMD()) return;
      cancelPending();
      needsRender = true;
      pending = setTimeout(() => {
        pending = undefined;
        if (!ownsOSMD()) return;
        // A container can hide between its resize notification and the
        // debounced render. Keep the next visible size eligible for reflow.
        if (!(container.getBoundingClientRect().width > 0)) {
          width = 0;
          return;
        }
        try {
          reflow();
          needsRender = false;
        } catch {
          // A later visible resize can retry a failed third-party render.
        }
      }, 100);
    };
    const view = container.ownerDocument?.defaultView ?? window;
    let observer: ResizeObserver | undefined;
    if (view.ResizeObserver) {
      observer = new view.ResizeObserver((entries) => {
        if (!ownsOSMD()) return;
        const next = entries[0]?.contentRect.width;
        if (next === undefined || !Number.isFinite(next)) return;
        if (next <= 0) {
          width = 0;
          needsRender = true;
          cancelPending();
          return;
        }
        // Engraving changes height itself. Only width changes require reflow.
        if (!needsRender && Math.abs(next - width) < 0.5) return;
        width = next;
        onResize();
      });
      observer.observe(container);
    } else view.addEventListener('resize', onResize);
    removeResizeListener = () => {
      cancelPending();
      observer?.disconnect();
      if (!observer) view.removeEventListener('resize', onResize);
    };
  }

  let cursor = osmd.cursor;
  let cursorVisible = true;
  if (ownsOSMD()) cursor?.show?.();

  const noteSequence = scoreToNoteSequence(score);

  // --- Cursor-seek state -----------------------------------------------
  // The OSMD iterator is forward-only: a backward seek must reset() and
  // re-walk. Re-walking naively reads iterator.currentTimeStamp.RealValue
  // (a Fraction computation in real OSMD) at every step. We keep:
  //  - `lastTargetWholeNotes`: dedupes redraws for chords — multiple notes
  //    at the same timestamp trigger zero extra cursor work;
  //  - sparse checkpoints (wholeNotes -> step count) recorded every
  //    CHECKPOINT_INTERVAL forward steps. On a backward seek we binary-search
  //    for the last checkpoint <= target, reset(), batch-step to its step
  //    count without reading timestamps, then fine-step (< one interval)
  //    comparing timestamps to land on the target.
  let lastTargetWholeNotes: number | null = null;
  let checkpoints: CursorCheckpoint[] = [];
  let stepCount = 0;

  const invalidateSeekState = (): void => {
    lastTargetWholeNotes = null;
    checkpoints = [];
    stepCount = 0;
  };

  /** Returns true when the cursor visually moved (target changed). */
  const moveCursorTo = (targetWholeNotes: number): boolean => {
    let iterator = cursor?.iterator;
    if (!cursor?.next || !iterator) return false;
    if (
      lastTargetWholeNotes !== null &&
      Math.abs(targetWholeNotes - lastTargetWholeNotes) < EPSILON
    ) {
      // Same target as the previous redraw (e.g. the other notes of a
      // chord at one timestamp): no cursor work at all.
      return false;
    }
    lastTargetWholeNotes = targetWholeNotes;

    if (currentWholeNotes(iterator) > targetWholeNotes + EPSILON) {
      // Backward seek: forward-only iterator, so reset and replay. Jump to
      // the last checkpoint at or before the target without per-step
      // timestamp reads, then fall through to the fine forward walk.
      cursor.reset?.();
      // Real OSMD reset() replaces cursor.iterator. The old iterator keeps
      // its later timestamp/EndReached flag and cannot drive the replay.
      iterator = cursor.iterator;
      if (!iterator) {
        invalidateSeekState();
        return false;
      }
      stepCount = 0;
      const checkpoint = lastCheckpointAtOrBefore(checkpoints, targetWholeNotes);
      if (checkpoint) {
        let guard = 0;
        while (stepCount < checkpoint.steps && !iterator.EndReached && guard < MAX_CURSOR_STEPS) {
          cursor.next();
          stepCount += 1;
          guard += 1;
        }
      }
    }

    let guard = 0;
    while (
      !iterator.EndReached &&
      currentWholeNotes(iterator) < targetWholeNotes - EPSILON &&
      guard < MAX_CURSOR_STEPS
    ) {
      cursor.next();
      stepCount += 1;
      guard += 1;
      if (stepCount % CHECKPOINT_INTERVAL === 0) {
        const wholeNotes = currentWholeNotes(iterator);
        const last = checkpoints[checkpoints.length - 1];
        // Only record strictly increasing positions so replayed steps after
        // a reset never duplicate existing checkpoints.
        if (!last || wholeNotes > last.wholeNotes + EPSILON) {
          checkpoints.push({wholeNotes, steps: stepCount});
        }
      }
    }
    cursor.update?.();
    return true;
  };

  /** OSMD replaces cursor objects while rebuilding its drawing backends. */
  const reflow = (): void => {
    const target = lastTargetWholeNotes;
    osmd.render();
    if (!ownsOSMD()) return;
    cursor = osmd.cursor;
    invalidateSeekState();
    if (target !== null) {
      // Reset before reading the new iterator: restored OSMD iterators may
      // already be partway through the score, but our checkpoint steps count
      // from the beginning of this cursor's lifetime.
      cursor?.reset?.();
      if (!ownsOSMD()) return;
      moveCursorTo(target);
    }
    if (!ownsOSMD()) return;
    if (cursorVisible) cursor?.show?.();
    else cursor?.hide?.();
  };

  // rAF-coalesced scrollIntoView: many cursor moves within one frame
  // produce a single scroll (same scheduleFrame pattern as the base visualizer).
  let scrollScheduled = false;
  let scrollRevision = 0;
  const invalidateScroll = (): void => {
    scrollRevision += 1;
    scrollScheduled = false;
  };
  const scheduleScrollIntoView = (): void => {
    if (scrollScheduled) return;
    scrollScheduled = true;
    const revision = scrollRevision;
    scheduleFrame(() => {
      if (revision !== scrollRevision) return;
      scrollScheduled = false;
      if (ownsOSMD() && cursorVisible) {
        cursor?.cursorElement?.scrollIntoView?.({block: 'nearest', inline: 'center'});
      }
    });
  };

  const redrawAtTime = (seconds: number, scrollIntoView?: boolean): null => {
    if (!ownsOSMD()) return null;
    if (!Number.isFinite(seconds)) throw new RangeError('Score view time must be finite.');
    if (scrollIntoView === false) invalidateScroll();
    if (!cursorVisible) {
      cursorVisible = true;
      cursor?.show?.();
    }
    const ticks = secondsToTick(score, seconds);
    const moved = moveCursorTo(ticks / DEFAULT_PPQ / 4); // ticks -> quarters -> whole notes
    if (moved && (scrollIntoView ?? options.followCursor ?? true)) scheduleScrollIntoView();
    return null;
  };

  return {
    noteSequence,
    visualizer: osmd,
    redrawAtTime,
    redraw(activeNote?: ScoreSequenceNote, scrollIntoView?: boolean): number | null {
      if (!ownsOSMD()) return null;
      // A caller can withdraw a pending scroll without clearing or moving the
      // cursor. This also handles a note-off repaint before the queued frame.
      if (scrollIntoView === false) invalidateScroll();
      if (!activeNote) return null;
      return redrawAtTime(activeNote.startTime ?? 0, scrollIntoView);
    },
    clearActiveNotes(): void {
      if (!ownsOSMD()) return;
      invalidateScroll();
      cursorVisible = false;
      cursor?.reset?.();
      cursor?.hide?.();
      invalidateSeekState();
    },
    dispose(): void {
      if (released) return;
      invalidateScroll();
      const mayMutateOSMD = constructedHere || ownsOSMD();
      released = true;
      if (mayMutateOSMD && adoptedState) adoptedState.generation += 1;
      removeAbortListener?.();
      removeAbortListener = undefined;
      removeResizeListener?.();
      removeResizeListener = undefined;
      if (mayMutateOSMD) {
        cursor?.hide?.();
        osmd.clear?.();
      }
      invalidateSeekState();
    },
  };
}

function assertOSMDRequestCurrent(
  signal?: AbortSignal,
  state?: AdoptedOSMDState,
  generation?: number,
  aborted = signal?.aborted ?? false,
): void {
  if (!aborted && !signal?.aborted && (!state || state.generation === generation)) return;
  const error = new Error('OSMD render was cancelled or superseded by a newer request.');
  error.name = 'AbortError';
  throw error;
}

const EPSILON = 1e-6;
const MAX_CURSOR_STEPS = 100_000;
/** Record a seek checkpoint every this many forward cursor steps. */
const CHECKPOINT_INTERVAL = 64;

interface CursorCheckpoint {
  /** Iterator timestamp (whole notes) after `steps` next() calls from reset. */
  wholeNotes: number;
  steps: number;
}

/** Binary-search the last checkpoint at or before `target` (or null). */
function lastCheckpointAtOrBefore(
  checkpoints: readonly CursorCheckpoint[],
  target: number,
): CursorCheckpoint | null {
  let lo = 0;
  let hi = checkpoints.length - 1;
  let best: CursorCheckpoint | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (checkpoints[mid].wholeNotes <= target + EPSILON) {
      best = checkpoints[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

function currentWholeNotes(iterator: NonNullable<OSMDCursor['iterator']>): number {
  return iterator.currentTimeStamp?.RealValue ?? 0;
}

/**
 * Run `callback` on the next animation frame, or synchronously when
 * requestAnimationFrame is unavailable (e.g. Node test environments).
 * Same coalescing pattern as the base visualizer.
 */
function scheduleFrame(callback: () => void): void {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(callback);
  } else {
    callback();
  }
}

/**
 * Dynamically import the optional `opensheetmusicdisplay` peer. Left as a
 * lazy import with a literal specifier so browser bundlers can emit a chunk.
 */
async function loadOSMD(): Promise<OSMDStaffOptions['OpenSheetMusicDisplay']> {
  try {
    const mod: Record<string, unknown> = await import('opensheetmusicdisplay');
    const Ctor = (mod.OpenSheetMusicDisplay ??
      (mod.default as Record<string, unknown> | undefined)?.OpenSheetMusicDisplay ??
      mod.default) as OSMDStaffOptions['OpenSheetMusicDisplay'];
    if (!Ctor) throw new Error('OpenSheetMusicDisplay export not found');
    return Ctor;
  } catch (cause) {
    throw new Error(
      'Could not load opensheetmusicdisplay. Install the optional peer dependency, ' +
        `or pass \`OpenSheetMusicDisplay\`/\`osmd\` to renderOSMDStaffVisualizer. (${String(cause)})`,
    );
  }
}
